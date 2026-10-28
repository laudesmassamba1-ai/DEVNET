"use client";

import { Loading } from "@/components/Avatar";

export default function LoadingUI() {
  return (
    <div className="flex min-h-[calc(100dvh-var(--h-banner,0px))] items-center justify-center">
      <Loading label="Chargement…" />
    </div>
  );
}