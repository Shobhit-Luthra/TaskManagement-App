export const metadata = { title: "Offline · Kanbo" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-serif text-3xl">You&apos;re offline</h1>
      <p className="text-muted-foreground text-sm">
        Kanbo needs a connection to load your boards. Check your network and try again.
      </p>
    </main>
  );
}
