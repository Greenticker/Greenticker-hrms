import React, { useState } from 'react';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';
import { ChatbotDrawer } from './ChatbotDrawer';
import { NotificationDrawer } from './NotificationDrawer';
import { useAuth } from '../../context/AuthContext';
import { Lock } from 'lucide-react';

interface BaseLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  sectionTitle?: string;
}

export const BaseLayout: React.FC<BaseLayoutProps> = ({
  children,
  activeTab,
  onSelectTab,
  sectionTitle,
}) => {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { user } = useAuth();
  // Auditors are read-only everywhere (the API refuses any change they attempt)
  const isReadOnly = user?.role === 'AUDITORS';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      <Navbar
        onOpenNotifications={() => setIsNotificationsOpen(true)}
        currentSectionTitle={sectionTitle}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      <div className="flex-1 flex min-h-[calc(100vh-4rem)]">
        <Sidebar activeTab={activeTab} onSelectTab={onSelectTab} isOpen={isSidebarOpen} />

        <main className="flex-1 min-w-0 p-6 md:p-8">
          <div className="max-w-[1440px] mx-auto">
            {isReadOnly && (
              <div role="note" className="mb-4 p-4 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-700 flex items-center gap-2">
                <Lock className="w-4 h-4 shrink-0" />
                Auditor access is read-only. You can view records but not create, change, approve or delete anything.
              </div>
            )}
            {children}
          </div>
        </main>
      </div>

      <ChatbotDrawer isOpen={isChatOpen} onToggle={() => setIsChatOpen(!isChatOpen)} onClose={() => setIsChatOpen(false)} />
      <NotificationDrawer isOpen={isNotificationsOpen} onClose={() => setIsNotificationsOpen(false)} />
    </div>
  );
};
