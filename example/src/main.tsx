import { ConvexProvider, ConvexReactClient } from "convex/react";
import { createRoot } from "react-dom/client";
import App from "./App";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
const client = new ConvexReactClient(convexUrl);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing root element");
}

const root = createRoot(rootElement);
root.render(
  <ConvexProvider client={client}>
    <App />
  </ConvexProvider>,
);
