import {card, status} from "sailry/cards";
import {fallback} from "../desktop/locales.js";

export async function connection() {
  const {configured} = await status("notion");
  const result = {configured, sailry_content: {version: 1, blocks: [
    card("connection", {configured}, fallback(configured ? "connected" : "connect")),
  ]}};
  return result;
}
