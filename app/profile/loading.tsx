"use client";

export default function LoadingUI() {
  return (
    <div className="px-(--gutter) pt-3">
      <div className="mx-auto max-w-[560px] space-y-4">
        <div className="mo-rise rounded-(--radius-card) border border-line-2 bg-surface p-4 shadow-sh-1">
          <div className="flex gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full border bg-surface-2" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-1/3 bg-surface-2 rounded mo-pulse" />
              <div className="h-3 w-1/2 bg-surface-2 rounded mo-pulse" />
            </div>
          </div>
        </div>
        <div className="mo-rise rounded-(--radius-card) border border-line-2 bg-surface p-4 shadow-sh-1">
          <div className="h-4 w-1/4 bg-surface-2 rounded mo-pulse mb-3" />
          <div className="space-y-2">
            <div className="h-3 w-full bg-surface-2 rounded mo-pulse" />
            <div className="h-3 w-3/4 bg-surface-2 rounded mo-pulse" />
            <div className="h-3 w-1/2 bg-surface-2 rounded mo-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}