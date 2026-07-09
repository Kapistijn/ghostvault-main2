/**
 * MODULE: Database Schema
 *
 * Verantwoordelijkheid:
 *  - Database interfaces en schema definities
 *  - SQLite standaard, PostgreSQL optioneel
 *  - Tabellen: users, devices, trusted_devices, transfers, transfer_chunks, audit_log, settings, sessions
 *
 * Gebruikt door:
 *  - server/src/storage/
 *
 * Afhankelijk van:
 *  - Geen
 *
 * @module server/src/storage/database
 */

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
}

export interface Device {
  id: string;
  userId: string;
  deviceId: string;
  name: string;
  lastSeen: Date;
  online: boolean;
}

export interface TrustedDevice {
  id: string;
  userId: string;
  connectionId: string;
  friendName: string;
  createdAt: Date;
}

export interface Transfer {
  id: string;
  transferId: string;
  currentChunk: number;
  totalChunks: number;
  checksumStatus: string;
  lastProcessed: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: Date;
  fileName: string;
  fileSize: number;
}

export interface TransferChunk {
  id: string;
  transferId: string;
  chunkId: number;
  offset: number;
  compressedSize: number;
  originalSize: number;
  sha256: string;
  status: 'pending' | 'completed' | 'failed';
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  details: string;
  createdAt: Date;
}

export interface Setting {
  id: string;
  userId: string;
  key: string;
  value: string;
}

export interface Session {
  id: string;
  userId: string;
  deviceId: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Database interface voor meerdere backends
 */
export interface Database {
  // Users
  createUser(user: Omit<User, 'id' | 'createdAt'>): Promise<User>;
  getUserById(id: string): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;

  // Devices
  createDevice(device: Omit<Device, 'id' | 'lastSeen'>): Promise<Device>;
  getDevicesByUserId(userId: string): Promise<Device[]>;
  updateDeviceLastSeen(deviceId: string): Promise<void>;

  // TrustedDevices
  createTrustedDevice(device: Omit<TrustedDevice, 'id' | 'createdAt'>): Promise<TrustedDevice>;
  getTrustedDevicesByUserId(userId: string): Promise<TrustedDevice[]>;

  // Transfers
  createTransfer(transfer: Omit<Transfer, 'id' | 'createdAt'>): Promise<Transfer>;
  getTransferById(id: string): Promise<Transfer | null>;
  getTransferByTransferId(transferId: string): Promise<Transfer | null>;
  updateTransfer(id: string, updates: Partial<Transfer>): Promise<void>;
  getActiveTransfers(): Promise<Transfer[]>;

  // TransferChunks
  createTransferChunk(chunk: Omit<TransferChunk, 'id'>): Promise<TransferChunk>;
  getChunksByTransferId(transferId: string): Promise<TransferChunk[]>;
  updateChunkStatus(id: string, status: TransferChunk['status']): Promise<void>;
  getFailedChunks(transferId: string): Promise<TransferChunk[]>;

  // AuditLog
  createAuditLog(log: Omit<AuditLog, 'id' | 'createdAt'>): Promise<AuditLog>;
  getAuditLogsByUserId(userId: string, limit?: number): Promise<AuditLog[]>;

  // Settings
  createSetting(setting: Omit<Setting, 'id'>): Promise<Setting>;
  getSetting(userId: string, key: string): Promise<Setting | null>;
  updateSetting(userId: string, key: string, value: string): Promise<void>;

  // Sessions
  createSession(session: Omit<Session, 'id' | 'createdAt'>): Promise<Session>;
  getSessionById(id: string): Promise<Session | null>;
  deleteSession(id: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;

  // Cleanup
  close(): Promise<void>;
}
