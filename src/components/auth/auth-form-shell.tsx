"use client";

import { type ReactNode } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AuthFormShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="bg-surface-lowest shadow-tier2 w-full max-w-md border-0 py-8 sm:py-10">
      <CardHeader className="gap-3 px-6 sm:px-9">
        <Brand className="mb-3" />
        <CardTitle>
          <h1 className="text-headline-lg font-serif font-medium">{title}</h1>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 px-6 sm:px-9">
        <Button className="bg-surface-low h-11 w-full" variant="outline" asChild>
          <a href="/auth/google">Continue with Google</a>
        </Button>
        <div className="text-muted-foreground relative text-center text-xs before:absolute before:top-1/2 before:left-0 before:w-[45%] before:border-t after:absolute after:top-1/2 after:right-0 after:w-[45%] after:border-t">
          or
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
