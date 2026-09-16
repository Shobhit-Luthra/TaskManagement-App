export function MemberAvatarStack({
  members,
}: {
  members: { userId: string; displayName: string }[];
}) {
  const visible = members.slice(0, 5);
  const overflow = members.length - visible.length;
  return (
    <div className="flex -space-x-2" aria-label={`${members.length} members`}>
      {visible.map((member) => (
        <span
          key={member.userId}
          title={member.displayName}
          className="bg-muted text-muted-foreground flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-medium"
        >
          {member.displayName.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {overflow > 0 && (
        <span className="bg-muted text-muted-foreground flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-medium">
          +{overflow}
        </span>
      )}
    </div>
  );
}
