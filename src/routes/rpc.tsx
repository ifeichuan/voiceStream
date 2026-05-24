import { createFileRoute } from "@tanstack/react-router";
import RpcTerminal from "../pages/RpcTerminal";

export const Route = createFileRoute("/rpc")({
  component: RpcTerminal,
});
