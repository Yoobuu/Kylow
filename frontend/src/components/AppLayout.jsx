import Navbar from "./Navbar";
import Footer from "./Footer";
import TutorialButton from "./TutorialButton";
import TutorialOverlay from "./TutorialOverlay";

export default function AppLayout({ children, mainClassName = "" }) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-neutral-900">
      <Navbar />
      <div className={`flex-1 ${mainClassName || "px-4 py-6 sm:px-6"}`}>{children}</div>
      <Footer />
      <TutorialButton />
      <TutorialOverlay />
    </div>
  );
}
