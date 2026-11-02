import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { request } from '../../services/api';
import { Bot, X, Send, Sparkles, AlertCircle, Ticket, CheckCircle2 } from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  isBlocked?: boolean;
  isError?: boolean;
  noPolicyFound?: boolean;
  pendingQuery?: string;
  ticketCreated?: boolean;
  ticketNumber?: string;
}

interface ChatbotDrawerProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export const ChatbotDrawer: React.FC<ChatbotDrawerProps> = ({ isOpen, onToggle, onClose }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: `Hello ${user?.firstName || 'there'}! I am your vetan.ai HR Assistant. I can help answer questions regarding company policies, leave guidelines, working hours, benefits, and HR procedures.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activePendingQuery, setActivePendingQuery] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, isOpen]);

  const handleRaiseTicketConfirm = async (queryToRaise: string) => {
    const userConfirmMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: 'Yes, please raise an HR Support Ticket for my query.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userConfirmMsg]);
    setIsLoading(true);
    setActivePendingQuery(null);

    try {
      const res = await request<{
        success: boolean;
        reply: string;
        ticketNumber: string;
      }>('/ai/raise-ticket', {
        method: 'POST',
        body: JSON.stringify({ query: queryToRaise }),
      });

      const botTicketMsg: ChatMessage = {
        id: `bot_ticket_${Date.now()}`,
        sender: 'assistant',
        text: res.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        ticketCreated: true,
        ticketNumber: res.ticketNumber,
      };
      setMessages((prev) => [...prev, botTicketMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sender: 'assistant',
          text: `Failed to create ticket: ${err.message || 'An unexpected error occurred.'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRaiseTicketDecline = () => {
    const userDeclineMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: 'No thanks, do not raise a ticket.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const botDeclineAck: ChatMessage = {
      id: `bot_ack_${Date.now()}`,
      sender: 'assistant',
      text: 'Understood! Feel free to ask if you have any other questions regarding company policies or procedures.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userDeclineMsg, botDeclineAck]);
    setActivePendingQuery(null);
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;

    const trimmedInput = input.trim();

    // Check if user is answering "yes" / "no" to a pending ticket prompt
    if (activePendingQuery) {
      const lower = trimmedInput.toLowerCase();
      if (['yes', 'raise', 'sure', 'yeah', 'ok', 'please', 'yes please', 'raise ticket'].some((k) => lower.includes(k))) {
        setInput('');
        await handleRaiseTicketConfirm(activePendingQuery);
        return;
      } else if (['no', 'cancel', 'dont', "don't", 'no thanks', 'skip'].some((k) => lower.includes(k))) {
        setInput('');
        handleRaiseTicketDecline();
        return;
      }
    }

    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: trimmedInput,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await request<{
        reply: string;
        blocked?: boolean;
        noPolicyFound?: boolean;
        pendingQuery?: string;
      }>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ prompt: userMsg.text }),
      });

      const botMsg: ChatMessage = {
        id: `bot_${Date.now()}`,
        sender: 'assistant',
        text: res.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isBlocked: res.blocked,
        noPolicyFound: res.noPolicyFound,
        pendingQuery: res.pendingQuery,
      };

      setMessages((prev) => [...prev, botMsg]);

      if (res.noPolicyFound && res.pendingQuery) {
        setActivePendingQuery(res.pendingQuery);
      } else {
        setActivePendingQuery(null);
      }
    } catch (err: any) {
      const isAccessDenied =
        err.status === 403 ||
        String(err.message || '').toLowerCase().includes('permission') ||
        String(err.message || '').toLowerCase().includes('denied');
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sender: 'assistant',
          text: isAccessDenied
            ? `Access Denied: ${err.message || 'You do not have permission to perform this query.'}`
            : `Notice: ${err.message || 'Unable to connect to HR assistant. Please try again momentarily.'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isBlocked: isAccessDenied,
          isError: !isAccessDenied,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const sampleQuestions = [
    'What is the company casual leave policy?',
    'How is overtime calculated?',
    'What are the standard working hours?',
    'Can I apply for sabbatical for higher studies?',
  ];

  return (
    <>
      {/* Floating Circular Button at Bottom Right */}
      <button
        onClick={onToggle}
        className="fixed bottom-6 right-6 z-45 w-14 h-14 rounded-full bg-brand-gradient text-white flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer group"
        title="Open AI Policy & HR Assistant"
      >
        <Bot className="w-6 h-6 text-white group-hover:rotate-12 transition-transform" />
      </button>

      {/* Popup Window */}
      {isOpen && (
        <div className="fixed bottom-22 right-6 z-50 w-80 sm:w-96 h-[480px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-2xs">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <span>vetan.ai HR Assistant</span>
                  <span className="inline-flex items-center gap-1 text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Online
                  </span>
                </h3>
                <p className="text-[10px] text-slate-500">
                  Role: <strong className="font-semibold text-slate-700">{user?.role}</strong>
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-slate-50/50">
            {messages.map((m) => (
              <div key={m.id} className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    m.sender === 'user'
                      ? 'bg-slate-900 text-white rounded-br-none'
                      : m.ticketCreated
                      ? 'bg-emerald-50 text-emerald-950 border border-emerald-300 rounded-bl-none shadow-xs'
                      : m.noPolicyFound
                      ? 'bg-indigo-50 text-indigo-950 border border-indigo-200 rounded-bl-none shadow-xs'
                      : m.isBlocked
                      ? 'bg-amber-50 text-amber-900 border border-amber-200 rounded-bl-none'
                      : m.isError
                      ? 'bg-rose-50 text-rose-900 border border-rose-200 rounded-bl-none'
                      : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none shadow-xs'
                  }`}
                >
                  {m.ticketCreated && (
                    <div className="flex items-center gap-1.5 font-bold text-emerald-800 mb-1 text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Ticket Raised Successfully</span>
                    </div>
                  )}

                  {m.isBlocked && (
                    <div className="flex items-center gap-1 font-bold text-amber-800 mb-0.5 text-[11px]">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>Access Restricted</span>
                    </div>
                  )}

                  <p className="whitespace-pre-line">{m.text}</p>

                  {/* Interactive Action Buttons for Ticket Confirmation */}
                  {m.noPolicyFound && m.pendingQuery && activePendingQuery === m.pendingQuery && !isLoading && (
                    <div className="mt-3 pt-2.5 border-t border-indigo-200/80 flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleRaiseTicketConfirm(m.pendingQuery!)}
                        className="w-full py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                      >
                        <Ticket className="w-3.5 h-3.5" />
                        <span>Yes, Raise HR Ticket</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleRaiseTicketDecline}
                        className="w-full py-1 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-[11px] font-semibold transition-all cursor-pointer text-center"
                      >
                        No, Thanks
                      </button>
                    </div>
                  )}
                </div>
                <span className="text-[9px] text-slate-400 mt-0.5 px-1">{m.timestamp}</span>
              </div>
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-white border border-slate-200 rounded-xl px-3 py-2 w-fit shadow-xs">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                <span>Processing request...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestions */}
          <div className="p-2.5 border-t border-slate-100 bg-white">
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Suggested Queries
            </p>
            <div className="flex flex-wrap gap-1">
              {sampleQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => setInput(q)}
                  className="text-[10px] text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded transition-colors text-left cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Input Form */}
          <form onSubmit={handleSend} className="p-2.5 border-t border-slate-200 bg-white flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                activePendingQuery
                  ? "Type 'Yes' to raise ticket or 'No' to cancel..."
                  : 'Ask about policies, leave, overtime...'
              }
              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:bg-white font-medium"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="p-1.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}
    </>
  );
};
