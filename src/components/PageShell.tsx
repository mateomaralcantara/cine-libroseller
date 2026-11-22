export function PageShell({ eyebrow, title, intro, children }: { eyebrow?: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1680px] px-4 pb-8 pt-28 sm:px-8 sm:pt-32 lg:px-12">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="display mt-2 text-4xl sm:text-6xl">{title}</h1>
      {intro && <div className="mt-3 max-w-2xl text-mist">{intro}</div>}
      <div className="mt-10">{children}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-line px-6 py-16 text-center">
      <p className="display text-2xl">{title}</p>
      {children && <div className="mx-auto mt-3 max-w-md text-mist">{children}</div>}
    </div>
  );
}
