export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 text-usfq-gray">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-2 w-2 rounded-full bg-usfq-gray/70"
          style={{
            animation: "typing-bounce 1.1s infinite",
            animationDelay: `${index * 0.15}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes typing-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
