import Link from "next/link";
import { ArrowRight, CheckCircle2, Columns3, ListChecks, ShieldCheck } from "lucide-react";

export default function LandingPage() {
  return (
    <main className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="font-semibold tracking-tight">Kanbo</span>
        <Link
          href="/login"
          className="text-muted-foreground hover:text-foreground text-sm font-medium"
        >
          Sign in
        </Link>
      </header>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-16 pb-20 lg:grid-cols-[1fr_0.9fr] lg:pt-28">
        <div>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Make the next move obvious.
          </h1>
          <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-8">
            Kanbo gives small teams one calm place to plan work, move it forward, and keep the
            important details close.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium"
            >
              Create your workspace <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/login"
              className="hover:bg-muted inline-flex items-center rounded-md border px-4 py-2.5 text-sm font-medium"
            >
              Sign in
            </Link>
          </div>
          <p className="text-muted-foreground mt-5 flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4" /> Start with a project and your first task.
          </p>
        </div>
        <div className="bg-muted rounded-2xl p-4 sm:p-6">
          <div className="bg-card rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <p className="text-muted-foreground text-sm">Website launch</p>
                <p className="mt-1 font-semibold">This week’s work</p>
              </div>
              <span className="rounded-full border px-2 py-1 text-xs">6 tasks</span>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
              <PreviewColumn
                title="To do"
                tasks={["Publish launch notes", "Review QA checklist"]}
              />
              <PreviewColumn title="In progress" tasks={["Finish mobile flow"]} />
              <PreviewColumn
                title="Done"
                tasks={["Set up workspace", "Invite the team", "Confirm domain"]}
              />
            </div>
          </div>
        </div>
      </section>
      <section className="bg-muted/40 border-t">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 md:grid-cols-3">
          <Feature
            icon={Columns3}
            title="A board that stays readable"
            text="Move tasks through a clear workflow without losing context."
          />
          <Feature
            icon={ListChecks}
            title="A second way to scan"
            text="Switch to a structured task list when details matter more than flow."
          />
          <Feature
            icon={ShieldCheck}
            title="Workspaces with boundaries"
            text="Role-aware access and an activity trail keep team work accountable."
          />
        </div>
      </section>
    </main>
  );
}

function PreviewColumn({ title, tasks }: { title: string; tasks: string[] }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground mb-2 text-xs font-medium">{title}</p>
      <div className="space-y-2">
        {tasks.map((task) => (
          <div key={task} className="bg-background rounded-md border p-2 text-xs leading-4">
            {task}
          </div>
        ))}
      </div>
    </div>
  );
}
function Feature({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Columns3;
  title: string;
  text: string;
}) {
  return (
    <div>
      <Icon className="size-5" aria-hidden="true" />
      <h2 className="mt-4 font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-2 text-sm leading-6">{text}</p>
    </div>
  );
}
