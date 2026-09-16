import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { peekInvite, acceptInvite, declineInvite } from "./actions";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await peekInvite(token);
  if (result.error === "not_found") notFound();
  if (result.error === "gone") {
    return (
      <div className="mx-auto mt-24 max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold">This invitation is no longer valid</h1>
        <p className="text-muted-foreground text-sm">
          It may have expired or already been used. Ask whoever invited you to send a new one.
        </p>
      </div>
    );
  }
  const invite = result.data!;

  async function accept() {
    "use server";
    const r = await acceptInvite(token);
    if (r.redirect) redirect(r.redirect);
  }

  async function decline() {
    "use server";
    const r = await declineInvite(token);
    if (r.redirect) redirect(r.redirect);
  }

  return (
    <div className="mx-auto mt-24 max-w-md space-y-6 text-center">
      <h1 className="text-xl font-semibold">
        {invite.inviter_display_name} invited you to {invite.project_name}
      </h1>
      <p className="text-muted-foreground text-sm">You&apos;d join as {invite.role}.</p>
      <div className="flex justify-center gap-3">
        <form action={accept}>
          <Button type="submit">Accept</Button>
        </form>
        <form action={decline}>
          <Button type="submit" variant="outline">
            Decline
          </Button>
        </form>
      </div>
    </div>
  );
}
