/**
 * SyncService - 数据同步服务
 * 
 * 为将来的 iCloud 同步功能预留接口。
 * 当前实现使用 localStorage 作为本地存储，
 * 未来可以扩展为 iCloud 或其他云存储服务。
 */

import type { Library, Settings, ChatMessage } from '../types';
import { loadStored, saveStored, STORAGE_KEYS } from './LocalStore';

// 同步状态
export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'offline';

// 同步事件类型
export interface SyncEvent {
    type: 'library' | 'settings' | 'chat' | 'all';
    status: SyncStatus;
    timestamp: number;
    error?: string;
}

// 同步后端类型（为将来扩展预留）
export type SyncBackend = 'localStorage' | 'iCloud' | 'custom';

// 同步数据结构
export interface SyncData {
    library: Library;
    settings: Settings;
    chatMessages: ChatMessage[];
    lastSyncedAt: number;
    deviceId: string;
}

// 生成设备 ID
function generateDeviceId(): string {
    const existing = loadStored<string | null>(STORAGE_KEYS.deviceId, null);
    if (existing) return existing;

    const newId = `device-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    saveStored(STORAGE_KEYS.deviceId, newId);
    return newId;
}

// 同步元数据
interface SyncMeta {
    lastSyncedAt: number;
    lastLocalChangeAt: number;
    pendingChanges: boolean;
}

/**
 * 同步服务类
 * 
 * 提供统一的数据存储和同步接口。
 * 当前使用 localStorage，未来可扩展支持 iCloud。
 */
class SyncServiceClass {
    private backend: SyncBackend = 'localStorage';
    private deviceId: string;
    private status: SyncStatus = 'idle';
    private listeners: Set<(event: SyncEvent) => void> = new Set();

    constructor() {
        this.deviceId = generateDeviceId();
    }

    // 获取当前同步状态
    getStatus(): SyncStatus {
        return this.status;
    }

    // 获取设备 ID
    getDeviceId(): string {
        return this.deviceId;
    }

    // 获取当前使用的后端
    getBackend(): SyncBackend {
        return this.backend;
    }

    // 添加状态监听器
    addListener(listener: (event: SyncEvent) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    // 通知所有监听器
    private notify(event: SyncEvent): void {
        this.listeners.forEach(listener => listener(event));
    }

    // ============ 本地存储操作 ============

    // 加载数据（通用）
    load<T>(key: string, defaultValue: T): T {
        return loadStored(key, defaultValue);
    }

    // 保存数据（通用）
    save<T>(key: string, value: T): void {
        saveStored(key, value);
        this.updateSyncMeta();
    }

    // 更新同步元数据
    private updateSyncMeta(): void {
        const meta: SyncMeta = this.load(STORAGE_KEYS.syncMeta, {
            lastSyncedAt: 0,
            lastLocalChangeAt: Date.now(),
            pendingChanges: true,
        });
        meta.lastLocalChangeAt = Date.now();
        meta.pendingChanges = true;
        saveStored(STORAGE_KEYS.syncMeta, meta);
    }

    // ============ Library 操作 ============

    loadLibrary(defaultValue: Library): Library {
        return this.load(STORAGE_KEYS.library, defaultValue);
    }

    saveLibrary(library: Library): void {
        this.save(STORAGE_KEYS.library, library);
    }

    // ============ Settings 操作 ============

    loadSettings(defaultValue: Settings): Settings {
        return this.load(STORAGE_KEYS.settings, defaultValue);
    }

    saveSettings(settings: Settings): void {
        this.save(STORAGE_KEYS.settings, settings);
    }

    // ============ Chat 操作 ============

    loadChatMessages(defaultValue: ChatMessage[]): ChatMessage[] {
        return this.load(STORAGE_KEYS.chat, defaultValue);
    }

    saveChatMessages(messages: ChatMessage[]): void {
        // 限制保存最近 100 条消息
        const toSave = messages.slice(-100);
        this.save(STORAGE_KEYS.chat, toSave);
    }

    // ============ iCloud 同步预留接口 ============

    /**
     * 检查 iCloud 是否可用
     * TODO: 实现 iCloud 检测逻辑
     */
    async isICloudAvailable(): Promise<boolean> {
        // 预留接口，当前返回 false
        // 未来需要通过 Tauri 调用原生 API 检测
        return false;
    }

    /**
     * 启用 iCloud 同步
     * TODO: 实现 iCloud 同步启用逻辑
     */
    async enableICloudSync(): Promise<boolean> {
        // 预留接口
        console.log('[SyncService] iCloud sync not yet implemented');
        return false;
    }

    /**
     * 手动触发同步
     * TODO: 实现云端同步逻辑
     */
    async sync(): Promise<boolean> {
        if (this.backend === 'localStorage') {
            // localStorage 不需要同步
            return true;
        }

        this.status = 'syncing';
        this.notify({
            type: 'all',
            status: 'syncing',
            timestamp: Date.now(),
        });

        try {
            // TODO: 实现 iCloud 同步逻辑
            // 1. 获取云端数据
            // 2. 合并本地和云端数据（基于时间戳）
            // 3. 上传合并后的数据
            // 4. 更新本地数据

            this.status = 'success';
            this.notify({
                type: 'all',
                status: 'success',
                timestamp: Date.now(),
            });
            return true;
        } catch (error) {
            this.status = 'error';
            this.notify({
                type: 'all',
                status: 'error',
                timestamp: Date.now(),
                error: String(error),
            });
            return false;
        }
    }

    /**
     * 获取同步元数据
     */
    getSyncMeta(): SyncMeta {
        return this.load(STORAGE_KEYS.syncMeta, {
            lastSyncedAt: 0,
            lastLocalChangeAt: 0,
            pendingChanges: false,
        });
    }

    /**
     * 导出所有数据（用于备份或迁移）
     */
    exportAllData(): SyncData {
        return {
            library: this.loadLibrary({ books: [], categories: [], lastUpdated: 0 }),
            settings: this.loadSettings({
                theme: 'light',
                fontSize: 16,
                fontFamily: 'Georgia',
                lineHeight: 1.6,
                allowEpubScripts: false,
            }),
            chatMessages: this.loadChatMessages([]),
            lastSyncedAt: Date.now(),
            deviceId: this.deviceId,
        };
    }

    /**
     * 导入数据（用于备份恢复或迁移）
     */
    importAllData(data: Partial<SyncData>): void {
        if (data.library) {
            this.saveLibrary(data.library);
        }
        if (data.settings) {
            this.saveSettings(data.settings);
        }
        if (data.chatMessages) {
            this.saveChatMessages(data.chatMessages);
        }
    }
}

// 导出单例
export const SyncService = new SyncServiceClass();

// 导出类型
export type { SyncMeta };
