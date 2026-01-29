import { useCallback, useEffect, useRef, useState } from "react";

export default function useAutoScroll({ offset = 140 } = {}) {
  const containerRef = useRef(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const updateIsAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distance <= offset;
    setIsAtBottom(nearBottom);
    if (nearBottom) {
      setUnreadCount(0);
    }
  }, [offset]);

  const scrollToBottom = useCallback((behavior = "smooth") => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    updateIsAtBottom();
    el.addEventListener("scroll", updateIsAtBottom, { passive: true });
    return () => el.removeEventListener("scroll", updateIsAtBottom);
  }, [updateIsAtBottom]);

  const notifyNewMessage = useCallback(() => {
    if (isAtBottom) {
      requestAnimationFrame(() => scrollToBottom("auto"));
    } else {
      setUnreadCount((count) => count + 1);
    }
  }, [isAtBottom, scrollToBottom]);

  const notifyNewToken = useCallback(() => {
    if (isAtBottom) {
      requestAnimationFrame(() => scrollToBottom("auto"));
    }
  }, [isAtBottom, scrollToBottom]);

  const resetUnread = useCallback(() => setUnreadCount(0), []);

  return {
    containerRef,
    isAtBottom,
    scrollToBottom,
    unreadCount,
    notifyNewMessage,
    notifyNewToken,
    resetUnread,
  };
}
