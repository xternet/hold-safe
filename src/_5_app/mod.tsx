import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Overview } from "./_0_overview/mod";
import "./style.css";
const element = document.getElementById("app");
if (element === null) throw new Error("Application mount missing");
createRoot(element).render(<StrictMode><Overview/></StrictMode>);
