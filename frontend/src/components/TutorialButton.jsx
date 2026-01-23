import { useLocation } from "react-router-dom";
import { useTutorial } from "../context/TutorialContext";
import { getTourKeyForLocation, tours } from "../tutorials";

export default function TutorialButton() {
  const location = useLocation();
  const { startTour, isOpen } = useTutorial();
  const tourKey = getTourKeyForLocation(location.pathname, location.search);
  const hasTour = tourKey && Array.isArray(tours[tourKey]) && tours[tourKey].length > 0;

  if (!hasTour) return null;

  return (
    <button
      type="button"
      onClick={() => startTour(tourKey)}
      disabled={isOpen}
      className="fixed bottom-6 right-6 z-[60] rounded-full border border-[#FFA300]/60 bg-[#FFA300] px-4 py-2 text-sm font-semibold text-black shadow-lg transition hover:bg-[#ffb133] disabled:cursor-not-allowed disabled:opacity-60"
    >
      Tutorial
    </button>
  );
}
