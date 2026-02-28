import { AnimatedLogo } from "@/components/AnimatedLogo";

export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-20 flex flex-col items-center gap-6">
      <AnimatedLogo className="h-[150px] w-auto" />
      <h1 className="text-5xl font-bold text-gradient tracking-tight">
        NEAR FM
      </h1>
    </div>
  );
}
