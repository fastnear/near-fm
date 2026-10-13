//! Cheap "is this actually audio?" check on the first bytes of a file.
//!
//! Uploads were only ever checked by MIME type and size, so a file of random
//! bytes named `.mp3` went live and silently failed to play. This looks at the
//! bytes themselves: container magic numbers, or a run of consecutive valid
//! MPEG audio frames for raw MP3 streams.

/// How many leading bytes the check needs; callers should fetch at least this much.
pub const SNIFF_BYTES: usize = 256 * 1024;

/// True when `head` (the start of a file) looks like an audio file we can play.
pub fn looks_like_audio(head: &[u8]) -> bool {
    if head.len() < 4 {
        return false;
    }
    if head.starts_with(b"ID3") {
        // ID3v2 tag: skip it and require audio frames right after. A bogus
        // file could start with "ID3" by accident; the frames settle it.
        return match id3v2_len(head) {
            Some(n) if n < head.len() => mp3_frames_at(&head[n..]) >= 2,
            // Tag longer than what we fetched: trust the tag header.
            Some(_) => true,
            None => false,
        };
    }
    if head.starts_with(b"OggS") || head.starts_with(b"fLaC") || head.starts_with(b"\x1aE\xdf\xa3") {
        return true;
    }
    if head.starts_with(b"RIFF") && head.len() >= 12 && &head[8..12] == b"WAVE" {
        return true;
    }
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        return true; // MP4/M4A/MOV family
    }
    if head.starts_with(b"\xff\xf1") || head.starts_with(b"\xff\xf9") {
        return true; // ADTS AAC
    }
    // Raw MP3: frames may start after junk (e.g. a stripped tag), so scan a little.
    let scan_end = head.len().min(64 * 1024);
    let mut i = 0;
    while i + 4 <= scan_end {
        if head[i] == 0xff && head[i + 1] & 0xe0 == 0xe0 && mp3_frames_at(&head[i..]) >= 3 {
            return true;
        }
        i += 1;
    }
    false
}

/// Total ID3v2 tag length (header + body, + footer when flagged), if the header is valid.
fn id3v2_len(head: &[u8]) -> Option<usize> {
    if head.len() < 10 || head[3] == 0xff || head[4] == 0xff {
        return None;
    }
    let size = &head[6..10];
    if size.iter().any(|b| b & 0x80 != 0) {
        return None; // syncsafe integer: high bit must be clear
    }
    let body = ((size[0] as usize) << 21) | ((size[1] as usize) << 14) | ((size[2] as usize) << 7) | size[3] as usize;
    let footer = if head[5] & 0x10 != 0 { 10 } else { 0 };
    Some(10 + body + footer)
}

/// Number of consecutive valid MPEG audio frames starting exactly at `buf[0]`,
/// counting only frames that fit entirely in `buf` (capped at 3).
fn mp3_frames_at(buf: &[u8]) -> usize {
    let mut pos = 0;
    let mut n = 0;
    while n < 3 {
        match mp3_frame_len(&buf[pos..]) {
            Some(len) if pos + len <= buf.len() => {
                pos += len;
                n += 1;
            }
            Some(_) => return n + 1, // header valid, frame runs past what we have
            None => return n,
        }
    }
    n
}

/// Byte length of the MPEG audio frame whose header starts at `b[0]`, or None
/// if the four bytes are not a valid header.
fn mp3_frame_len(b: &[u8]) -> Option<usize> {
    if b.len() < 4 || b[0] != 0xff || b[1] & 0xe0 != 0xe0 {
        return None;
    }
    let version = (b[1] >> 3) & 0x3; // 0 = MPEG2.5, 1 = reserved, 2 = MPEG2, 3 = MPEG1
    let layer = (b[1] >> 1) & 0x3; // 0 = reserved, 1 = III, 2 = II, 3 = I
    let bitrate_idx = (b[2] >> 4) as usize;
    let sr_idx = ((b[2] >> 2) & 0x3) as usize;
    let padding = ((b[2] >> 1) & 0x1) as usize;
    if version == 1 || layer == 0 || bitrate_idx == 0 || bitrate_idx == 15 || sr_idx == 3 {
        return None;
    }
    let mpeg1 = version == 3;
    const BR_V1: [[u32; 15]; 3] = [
        [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], // layer I
        [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],    // layer II
        [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],     // layer III
    ];
    const BR_V2: [[u32; 15]; 3] = [
        [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], // layer I
        [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],      // layer II
        [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],      // layer III
    ];
    let layer_row = (3 - layer) as usize;
    let bitrate = if mpeg1 { BR_V1[layer_row][bitrate_idx] } else { BR_V2[layer_row][bitrate_idx] } * 1000;
    let base_sr: [u32; 3] = [44100, 48000, 32000];
    let sample_rate = match version {
        3 => base_sr[sr_idx],
        2 => base_sr[sr_idx] / 2,
        _ => base_sr[sr_idx] / 4,
    };
    let len = match layer {
        3 => (12 * bitrate / sample_rate + padding as u32) * 4,
        2 => 144 * bitrate / sample_rate + padding as u32,
        _ => {
            let coef = if mpeg1 { 144 } else { 72 };
            coef * bitrate / sample_rate + padding as u32
        }
    };
    if len < 24 {
        return None;
    }
    Some(len as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One MPEG1 layer III frame, 128 kbps, 44.1 kHz: 417 bytes.
    fn mp3_frame() -> Vec<u8> {
        let mut f = vec![0xff, 0xfb, 0x90, 0x00];
        f.resize(417, 0x55);
        f
    }

    #[test]
    fn raw_mp3_frames_pass() {
        let mut data = mp3_frame();
        data.extend(mp3_frame());
        data.extend(mp3_frame());
        assert!(looks_like_audio(&data));
    }

    #[test]
    fn id3_followed_by_frames_passes() {
        let mut data = b"ID3\x04\x00\x00\x00\x00\x00\x0a".to_vec();
        data.extend([0u8; 10]);
        data.extend(mp3_frame());
        data.extend(mp3_frame());
        assert!(looks_like_audio(&data));
    }

    #[test]
    fn id3_without_frames_fails() {
        let mut data = b"ID3\x04\x00\x00\x00\x00\x00\x0a".to_vec();
        data.extend([0u8; 10]);
        data.extend(vec![0xb3u8; 4000]);
        assert!(!looks_like_audio(&data));
    }

    #[test]
    fn long_id3_tag_beyond_head_passes() {
        // Big embedded cover: tag longer than the sniffed prefix.
        let mut data = b"ID3\x03\x00\x00\x7f\x7f\x7f\x7f".to_vec();
        data.extend(vec![0u8; 1000]);
        assert!(looks_like_audio(&data));
    }

    #[test]
    fn containers_pass() {
        assert!(looks_like_audio(b"OggS\x00\x02\x00\x00\x00\x00\x00\x00"));
        assert!(looks_like_audio(b"fLaC\x00\x00\x00\x22"));
        assert!(looks_like_audio(b"RIFF\x24\x08\x00\x00WAVEfmt "));
        assert!(looks_like_audio(b"\x00\x00\x00\x20ftypM4A \x00\x00"));
        assert!(!looks_like_audio(b"RIFF\x24\x08\x00\x00AVI LIST"));
    }

    #[test]
    fn random_bytes_fail() {
        // Deterministic pseudo-random bytes, like the broken upload we saw.
        let mut x: u32 = 0x1234_5678;
        let data: Vec<u8> = (0..200_000)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x >> 24) as u8
            })
            .collect();
        assert!(!looks_like_audio(&data));
    }

    #[test]
    fn text_and_html_fail() {
        assert!(!looks_like_audio(b"<!doctype html><html><body>not found</body></html>"));
        assert!(!looks_like_audio(b"{\"error\":\"unauthorized\"}"));
        assert!(!looks_like_audio(b""));
    }

    #[test]
    fn frame_len_matches_spec() {
        assert_eq!(mp3_frame_len(&[0xff, 0xfb, 0x90, 0x00]), Some(417)); // MPEG1 L3 128k 44.1k
        assert_eq!(mp3_frame_len(&[0xff, 0xfb, 0x92, 0x00]), Some(418)); // + padding
        assert_eq!(mp3_frame_len(&[0xff, 0xf3, 0x44, 0x00]), Some(96)); // MPEG2 L3 32k 24k
        assert_eq!(mp3_frame_len(&[0xff, 0xfb, 0xf0, 0x00]), None); // bad bitrate index
        assert_eq!(mp3_frame_len(&[0xff, 0xfb, 0x9c, 0x00]), None); // reserved sample rate
        assert_eq!(mp3_frame_len(&[0xff, 0xeb, 0x90, 0x00]), None); // reserved version
    }
}
