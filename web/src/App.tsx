import { useConversation } from './hooks/useConversation';
import { ChatWindow } from './components/ChatWindow';

export default function App() {
  // 对话状态集中在 hook：消息、加载、错误、发送与清除错误
  const { messages, isLoading, error, sendMessage, clearError } = useConversation();

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-center border-b px-4 py-3 shrink-0">
        <h1 className="text-lg font-semibold">🎓 English Tutor</h1>
      </header>
      {/* flex-1 + overflow-hidden：让 ChatWindow 内部 ScrollArea 占满剩余高度 */}
      <main className="flex-1 overflow-hidden">
        <ChatWindow
          messages={messages}
          isLoading={isLoading}
          error={error}
          onSend={sendMessage}
          onDismissError={clearError}
        />
      </main>
    </div>
  );
}
