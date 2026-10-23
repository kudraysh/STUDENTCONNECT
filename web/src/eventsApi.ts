export type EventPerson = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  avatar: string | null;
  course: number;
  group: string;
};
export type EventData = {
  closedAt: string | null;
  id: string;
  title: string;
  description: string;
  place: string;
  startsAt: string;
  capacity: number;
  createdAt: string;
  organizerId: string;
  categoryId: string;
  organizer: EventPerson;
  category: { id: string; name: string };
  participants: number;
  free: number;
  pendingCount: number;
  isOrganizer: boolean;
  member: {
    state: "ACTIVE" | "LEFT" | "KICKED";
    joinCount: number;
    leaveCount: number;
    kickReason: string | null;
  } | null;
  application: {
    status: "PENDING" | "ACCEPTED" | "REJECTED" | "KICKED";
  } | null;
  canApply: boolean;
  applyBlock: string | null;
};
export type EventDetails = {
  event: EventData;
  participants: EventPerson[];
  applications: { id: string; createdAt: string; user: EventPerson }[];
};
export function eventDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}
export function eventStatus(e: EventData) {
  if (e.closedAt) return "Мероприятие закрыто";
  if (e.isOrganizer) return "Вы организатор";
  if (e.member?.state === "KICKED") return "Вы исключены";
  if (e.member?.state === "ACTIVE") return "Вы участвуете";
  if (e.application?.status === "PENDING") return "Заявка на рассмотрении";
  if (e.member?.state === "LEFT") return "Вы вышли из мероприятия";
  if (e.application?.status === "REJECTED") return "Заявка отклонена";
  return e.free > 0 ? `Свободных мест: ${e.free}` : "Мест нет";
}
