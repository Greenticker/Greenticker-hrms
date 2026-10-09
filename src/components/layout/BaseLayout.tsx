import React, { useState } from 'react';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';
import { ChatbotDrawer } from './ChatbotDrawer';
import { NotificationDrawer } from './NotificationDrawer';

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

        <main className="flex-1 p-6 md:p-8">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>

      <ChatbotDrawer isOpen={isChatOpen} onToggle={() => setIsChatOpen(!isChatOpen)} onClose={() => setIsChatOpen(false)} />
      <NotificationDrawer isOpen={isNotificationsOpen} onClose={() => setIsNotificationsOpen(false)} />
    </div>
  );
};
