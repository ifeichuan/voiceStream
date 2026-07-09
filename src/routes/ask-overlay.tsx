import { createFileRoute } from "@tanstack/react-router";
import AskOverlay from "../pages/AskOverlay";

export const Route = createFileRoute("/ask-overlay")({
  component: AskOverlay,
});
