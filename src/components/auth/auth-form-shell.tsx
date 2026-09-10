"use client";

import { type ReactNode } from "react";
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
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Button className="w-full" variant="outline" asChild>
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
