import { computeViewshed } from "@/lib/viewshed/computeViewshed";

self.onmessage = (event) => {
  const result = computeViewshed(event.data);
  self.postMessage(result);
};
