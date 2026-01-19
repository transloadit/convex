"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { useMemo } from "react";

export const Providers = ({
  convexUrl,
  children,
}: {
  convexUrl: string;
  children: React.ReactNode;
}) => {
  const client = useMemo(() => new ConvexReactClient(convexUrl), [convexUrl]);
  return <ConvexAuthProvider client={client}>{children}</ConvexAuthProvider>;
};
