"use client";

import dynamic from "next/dynamic";

// The map libraries need the browser, so the dashboard is never server-rendered.
const Dashboard = dynamic(() => import("./Dashboard"), {
  ssr: false,
  loading: () => <div className="flex h-dvh items-center justify-center bg-bg text-sm text-ink-3">Loading dashboard</div>,
});

export default function DashboardLoader() {
  return <Dashboard />;
}
