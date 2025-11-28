'use client';

import { Briefcase, Eye, BarChart3, Lock, BookOpen } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';

export type TabType = 'portfolio' | 'watchlist' | 'analysis' | 'methodology';

interface TabBarProps {
    activeTab: TabType;
    onTabChange: (tab: TabType) => void;
    onAuthRequired: () => void;
}

export function TabBar({ activeTab, onTabChange, onAuthRequired }: TabBarProps) {
    const { user } = useAuth();

    const tabs = [
        { id: 'portfolio' as TabType, label: 'Portfolio', icon: Briefcase, requiresAuth: true },
        { id: 'watchlist' as TabType, label: 'Watchlist', icon: Eye, requiresAuth: true },
        { id: 'analysis' as TabType, label: 'Analysis', icon: BarChart3, requiresAuth: false },
        { id: 'methodology' as TabType, label: 'How It Works', icon: BookOpen, requiresAuth: false },
    ];

    const handleTabClick = (tab: TabType, requiresAuth: boolean) => {
        if (requiresAuth && !user) {
            onAuthRequired();
            return;
        }
        onTabChange(tab);
    };

    return (
        <div className="bg-white border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <nav className="flex gap-1" aria-label="Tabs">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        const isLocked = tab.requiresAuth && !user;

                        return (
                            <button
                                key={tab.id}
                                onClick={() => handleTabClick(tab.id, tab.requiresAuth)}
                                className={`
                                    flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                                    ${isActive 
                                        ? 'border-teal-500 text-teal-600' 
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }
                                    ${isLocked ? 'opacity-60' : ''}
                                `}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                                {isLocked && <Lock className="w-3 h-3 ml-1" />}
                            </button>
                        );
                    })}
                </nav>
            </div>
        </div>
    );
}


