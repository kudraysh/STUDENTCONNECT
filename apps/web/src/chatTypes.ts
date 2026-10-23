export type ChatPerson = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  avatar: string | null;
  group: string;
  course: number;
};
export type Message = {
  id: number;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
  clientId: string;
  editedAt:string|null;deletedAt:string|null;hiddenForMe:boolean;replyToId:number|null;
  replyTo:{id:number;senderId:string;text:string;unavailable:boolean}|null;
};
export type Grant = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";
  version: number;
  requestedAt: string;
  updatedAt: string;
};
export type ChatDetails = {
  id: string;
  peer: ChatPerson & { hasPhone: boolean };
  hasOwnPhone: boolean;
  blockedByMe:boolean;unavailable:boolean;
  outgoing: Grant | null;
  incoming: Grant | null;
  phone: string | null;
};
export type Dialog = {
  id: string;
  peer: ChatPerson;
  lastMessage: Message | null;
  unread: number;
  phoneRequest: boolean;
  lastMessageAt: string;
};
export const messageTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export const messageDay = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
