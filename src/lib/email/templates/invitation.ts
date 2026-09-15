export function invitationEmail(params: {
  projectName: string;
  inviterDisplayName: string;
  role: string;
  acceptUrl: string;
}) {
  const subject = `${params.inviterDisplayName} invited you to ${params.projectName} on Kanbo`;
  const text = `${params.inviterDisplayName} invited you to join "${params.projectName}" on Kanbo as a ${params.role}.\n\nAccept the invitation: ${params.acceptUrl}\n\nIf you weren't expecting this, you can ignore this email.`;
  const html = `<p>${params.inviterDisplayName} invited you to join <strong>${escapeHtml(params.projectName)}</strong> on Kanbo as a ${escapeHtml(params.role)}.</p><p><a href="${params.acceptUrl}">Accept the invitation</a></p><p>If you weren't expecting this, you can ignore this email.</p>`;
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}
