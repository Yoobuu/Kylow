import ChatContainer from "./ai-chat/ChatContainer";
import { useAuth } from "../context/AuthContext";
import AccessDenied from "./AccessDenied";

export default function AiChatPanel() {
  const { hasPermission } = useAuth();
  const canUseAi = hasPermission("ai.chat");

  if (!canUseAi) {
    return <AccessDenied description="No tienes acceso a KYLOW." />;
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
      <ChatContainer />
    </div>
  );
}
