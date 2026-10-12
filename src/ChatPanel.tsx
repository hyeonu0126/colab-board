import React, { useEffect, useRef, useState } from 'react';
import { db } from './firebase';
import { ref, onValue, push, query, limitToLast, serverTimestamp } from 'firebase/database';

interface ChatMessage {
  id: string;
  userName: string;
  text: string;
  createdAt: number;
}

interface ChatPanelProps {
  roomName: string;
  userName: string;
  // 새 메시지 도착 시 부모에게 알림 (사이드바가 접혀 있을 때 배지 표시용)
  onNewMessage?: () => void;
}

const MAX_LENGTH = 500;

const formatTime = (ts: number) => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const ChatPanel: React.FC<ChatPanelProps> = ({ roomName, userName, onNewMessage }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [showNewBtn, setShowNewBtn] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const isFirstLoadRef = useRef(true);
  const lastCountRef = useRef(0);
  const onNewMessageRef = useRef(onNewMessage);
  useEffect(() => {
    onNewMessageRef.current = onNewMessage;
  });

  // 최근 100개 메시지 구독
  useEffect(() => {
    isFirstLoadRef.current = true;
    lastCountRef.current = 0;
    const messagesQuery = query(ref(db, `rooms/${roomName}/messages`), limitToLast(100));
    const unsubscribe = onValue(messagesQuery, (snapshot) => {
      const list: ChatMessage[] = [];
      snapshot.forEach((child) => {
        const v = child.val();
        list.push({ id: child.key as string, userName: v.userName, text: v.text, createdAt: v.createdAt });
      });
      setMessages(list);

      // 최초 로드가 아닌 상태에서 다른 사람의 메시지가 늘어났을 때만 알림
      const last = list[list.length - 1];
      if (!isFirstLoadRef.current && list.length > lastCountRef.current && last && last.userName !== userName) {
        onNewMessageRef.current?.();
      }
      isFirstLoadRef.current = false;
      lastCountRef.current = list.length;
    });
    return () => unsubscribe();
  }, [roomName, userName]);

  // 하단에 있을 때만 자동 스크롤, 아니면 "새 메시지" 버튼 노출
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setShowNewBtn(true);
    }
  }, [messages]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isAtBottomRef.current = atBottom;
    if (atBottom) setShowNewBtn(false);
  };

  const scrollToBottom = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isAtBottomRef.current = true;
    setShowNewBtn(false);
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text) return;
    push(ref(db, `rooms/${roomName}/messages`), {
      userName,
      text: text.slice(0, MAX_LENGTH),
      createdAt: serverTimestamp(),
    });
    setInput('');
    isAtBottomRef.current = true;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 IME 조합 중 Enter는 무시 (중복 전송 방지)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div
          ref={listRef}
          onScroll={handleScroll}
          style={{ height: '100%', overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          {messages.length === 0 && (
            <div style={{ margin: 'auto', fontSize: '12px', color: 'var(--text-dim)' }}>첫 메시지를 보내보세요 💬</div>
          )}
          {messages.map((m) => {
            const isMe = m.userName === userName;
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: '2px' }}>
                {!isMe && <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{m.userName}</span>}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', flexDirection: isMe ? 'row-reverse' : 'row' }}>
                  <div
                    style={{
                      maxWidth: '210px',
                      padding: '7px 11px',
                      borderRadius: '14px',
                      fontSize: '13px',
                      lineHeight: 1.4,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      backgroundColor: isMe ? 'var(--accent)' : 'var(--panel-2)',
                      color: isMe ? 'var(--accent-text)' : 'var(--text)',
                      border: isMe ? 'none' : '1px solid var(--border-soft)',
                    }}
                  >
                    {m.text}
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{formatTime(m.createdAt)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {showNewBtn && (
          <button
            onClick={scrollToBottom}
            style={{ position: 'absolute', bottom: '8px', left: '50%', transform: 'translateX(-50%)', padding: '5px 12px', fontSize: '11px', fontWeight: 600, borderRadius: '999px', border: 'none', cursor: 'pointer', backgroundColor: 'var(--accent)', color: 'var(--accent-text)', boxShadow: 'var(--shadow-sm)' }}
          >
            새 메시지 ↓
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '6px', padding: '10px 12px', borderTop: '1px solid var(--border)', alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={MAX_LENGTH}
          rows={1}
          placeholder="메시지를 입력하세요"
          style={{ flex: 1, resize: 'none', maxHeight: '80px', padding: '8px 12px', fontSize: '13px', fontFamily: 'inherit', borderRadius: '14px', border: '1px solid var(--border)', backgroundColor: 'var(--panel-2)', color: 'var(--text)', outline: 'none' }}
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim()}
          style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 700, borderRadius: '999px', border: 'none', cursor: input.trim() ? 'pointer' : 'not-allowed', backgroundColor: 'var(--accent)', color: 'var(--accent-text)', opacity: input.trim() ? 1 : 0.5 }}
        >
          전송
        </button>
      </div>
    </div>
  );
};
