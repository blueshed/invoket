export interface Message {
  author: string;
  text: string;
  at: string;
}

export interface BoardDoc {
  messages: Record<string, Message>;
}
