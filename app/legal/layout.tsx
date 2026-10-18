import { LegalPlaceholder, SiteFrame } from "@/components/site-frame";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteFrame>
      <article className="mx-auto max-w-3xl space-y-6 px-6 pb-20 pt-10 text-sm leading-6">
        <LegalPlaceholder />
        {children}
      </article>
    </SiteFrame>
  );
}
