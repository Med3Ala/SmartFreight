import { useEffect, useState } from "react";

// "light" | "dark", following the OS setting and any data-theme on the root element.
const read = () => (getComputedStyle(document.documentElement).colorScheme === "dark" ? "dark" : "light");

export default function useTheme() {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const update = () => setTheme(read());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", update);
      mo.disconnect();
    };
  }, []);
  return theme;
}
