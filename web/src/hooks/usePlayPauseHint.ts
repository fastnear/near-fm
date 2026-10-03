import { useEffect, useState } from "react";

/**
 * Controls visibility of the pause icon overlaid on a song's cover art.
 *
 * While `playing` is true the pause icon is shown, then auto-hidden after a short hold so
 * the cover art stays unobstructed (pair the returned flag with a ~700ms opacity transition
 * for a smooth ~3s fade-out). It reappears instantly when playback stops. Clicking the
 * cover should still toggle playback even while the icon is hidden.
 *
 * Shared by the song grid card (SongCard) and the song detail page (SongDetail) so both
 * behave identically.
 */
export function usePlayPauseHint(playing: boolean): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!playing) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2300); // +~700ms CSS fade ≈ 3s total
    return () => clearTimeout(t);
  }, [playing]);

  return visible;
}
