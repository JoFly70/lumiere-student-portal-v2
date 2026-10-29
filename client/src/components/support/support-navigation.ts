export function supportTicketFromSearch(search: string): string | null {
  const id = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("ticket")?.trim();
  return id || null;
}

export function supportStudentFromSearch(search: string): string | null {
  const id = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("studentId")?.trim();
  return id || null;
}

export function supportSearchWithStudent(search: string, studentId: string | null): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (studentId) params.set("studentId", studentId);
  else params.delete("studentId");
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function supportSearchWithTicket(search: string, ticketId: string | null): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (ticketId) params.set("ticket", ticketId);
  else params.delete("ticket");
  const value = params.toString();
  return value ? `?${value}` : "";
}
