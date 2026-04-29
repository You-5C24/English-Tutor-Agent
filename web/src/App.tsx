import { useCallback, useEffect, useRef, useState } from 'react';
import { useConversation } from './hooks/useConversation';
import { ChatWindow } from './components/ChatWindow';

export default function App() {
  // 对话状态集中在 hook：消息、加载、错误、发送、清除错误、重新开始
  const {
    messages,
    isStreaming,
    error,
    sendMessage,
    clearError,
    resetConversation,
    stop,
  } = useConversation();
  const [stopToast, setStopToast] = useState(false);
  const stopToastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (stopToastTimerRef.current != null) {
        window.clearTimeout(stopToastTimerRef.current);
      }
    };
  }, []);

  const handleStop = useCallback(() => {
    stop?.();
    setStopToast(true);
    if (stopToastTimerRef.current != null) {
      window.clearTimeout(stopToastTimerRef.current);
    }
    stopToastTimerRef.current = window.setTimeout(() => {
      setStopToast(false);
      stopToastTimerRef.current = null;
    }, 2000);
  }, [stop]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-center border-b px-4 py-3 shrink-0">
        <h1 className="text-lg font-semibold">🎓 English Tutor</h1>
      </header>
      {/* flex-1 + overflow-hidden：让 ChatWindow 内部 ScrollArea 占满剩余高度 */}
      <main className="min-h-0 flex-1 overflow-hidden">
        <ChatWindow
          messages={messages}
          isStreaming={isStreaming}
          error={error}
          stopToast={stopToast}
          onSend={sendMessage}
          onDismissError={clearError}
          onReset={resetConversation}
          onStop={handleStop}
        />
      </main>
    </div>
  );
}
