import { sql } from '@vercel/postgres'

// Local dev fallback: in-memory store when POSTGRES_URL is not configured
const HAS_DB = !!process.env.POSTGRES_URL || !!process.env.POSTGRES_URL_NON_POOLING
const memoryDb = new Map<string, import('./db').UserData>()
function todayDate(): string {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}
function ensureDailyReset(u: import('./db').UserData) {
  const today = todayDate()
  if (u.last_reset_date < today) {
    u.total_active_time_ms = 0
    u.last_reset_date = today
  }
}

export type UserData = {
  user_id: string // primary key (github id or google id)
  provider: 'github' | 'google'
  total_active_time_ms: number
  settings_json: string
  last_sync_at: number | null
  auto_sync_interval_minutes: number | null
  created_at: number
  updated_at: number
  last_reset_date: string // DATE type from database
}

// Initialize database table with trigger for daily reset
export async function initDatabase() {
  try {
    if (!HAS_DB) {
      console.warn('initDatabase: No POSTGRES_URL found. Using in-memory fallback for local dev.')
      return
    }
    await sql`
      CREATE TABLE IF NOT EXISTS microos_users (
        user_id VARCHAR(255) PRIMARY KEY,
        provider VARCHAR(20) NOT NULL,
        total_active_time_ms BIGINT DEFAULT 0,
        settings_json TEXT DEFAULT '{}',
        last_sync_at BIGINT,
        auto_sync_interval_minutes INTEGER,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        last_reset_date DATE NOT NULL DEFAULT CURRENT_DATE
      )
    `

    // Create function to reset active time
    await sql`
      CREATE OR REPLACE FUNCTION reset_daily_active_time()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.last_reset_date < CURRENT_DATE THEN
          NEW.total_active_time_ms := 0;
          NEW.last_reset_date := CURRENT_DATE;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `

    // Create trigger to run before update
    await sql`
      DROP TRIGGER IF EXISTS trigger_reset_daily_active_time ON microos_users;
    `

    await sql`
      CREATE TRIGGER trigger_reset_daily_active_time
      BEFORE UPDATE ON microos_users
      FOR EACH ROW
      EXECUTE FUNCTION reset_daily_active_time();
    `

    console.log('Database table and triggers initialized')
  } catch (error) {
    console.error('Database init error:', error)
  }
}

// Get or create user
export async function getOrCreateUser(
  userId: string,
  provider: 'github' | 'google'
): Promise<UserData> {
  const now = Date.now()

  try {
    if (!HAS_DB) {
      let u = memoryDb.get(userId)
      if (!u) {
        u = {
          user_id: userId,
          provider,
          total_active_time_ms: 0,
          settings_json: '{}',
          last_sync_at: null,
          auto_sync_interval_minutes: null,
          created_at: now,
          updated_at: now,
          last_reset_date: todayDate()
        }
        memoryDb.set(userId, u)
      }
      ensureDailyReset(u)
      return { ...u }
    }
    // Try to get existing user (trigger will auto-reset if needed)
    const result = await sql`
      SELECT * FROM microos_users WHERE user_id = ${userId}
    `

    if (result.rows.length > 0) {
      // Trigger a harmless update to invoke the reset trigger
      await sql`
        UPDATE microos_users 
        SET updated_at = ${now}
        WHERE user_id = ${userId}
      `
      
      // Fetch the updated user
      const updatedResult = await sql`
        SELECT * FROM microos_users WHERE user_id = ${userId}
      `
      
      return updatedResult.rows[0] as UserData
    }

    // Create new user
    await sql`
      INSERT INTO microos_users (
        user_id, 
        provider, 
        total_active_time_ms, 
        settings_json,
        created_at,
        updated_at
      ) VALUES (
        ${userId},
        ${provider},
        0,
        '{}',
        ${now},
        ${now}
      )
    `

    const newUserResult = await sql`
      SELECT * FROM microos_users WHERE user_id = ${userId}
    `

    return newUserResult.rows[0] as UserData
  } catch (error) {
    console.error('getOrCreateUser error:', error)
    throw error
  }
}

// Update user active time (trigger will auto-reset if new day)
export async function updateUserActiveTime(
  userId: string,
  activeTimeMs: number
): Promise<void> {
  const now = Date.now()

  try {
    if (!HAS_DB) {
      const u = memoryDb.get(userId)
      if (u) {
        ensureDailyReset(u)
        u.total_active_time_ms = activeTimeMs
        u.updated_at = now
        memoryDb.set(userId, u)
      }
      return
    }
    await sql`
      UPDATE microos_users 
      SET total_active_time_ms = ${activeTimeMs},
          updated_at = ${now}
      WHERE user_id = ${userId}
    `
  } catch (error) {
    console.error('updateUserActiveTime error:', error)
    throw error
  }
}

// Update user settings
export async function updateUserSettings(
  userId: string,
  settings: Record<string, any>
): Promise<void> {
  const now = Date.now()
  const settingsJson = JSON.stringify(settings)

  try {
    if (!HAS_DB) {
      const u = memoryDb.get(userId)
      if (u) {
        ensureDailyReset(u)
        u.settings_json = settingsJson
        u.updated_at = now
        memoryDb.set(userId, u)
      }
      return
    }
    await sql`
      UPDATE microos_users 
      SET settings_json = ${settingsJson},
          updated_at = ${now}
      WHERE user_id = ${userId}
    `
  } catch (error) {
    console.error('updateUserSettings error:', error)
    throw error
  }
}

// Update last sync timestamp
export async function updateLastSync(userId: string): Promise<void> {
  const now = Date.now()

  try {
    if (!HAS_DB) {
      const u = memoryDb.get(userId)
      if (u) {
        ensureDailyReset(u)
        u.last_sync_at = now
        u.updated_at = now
        memoryDb.set(userId, u)
      }
      return
    }
    await sql`
      UPDATE microos_users 
      SET last_sync_at = ${now},
          updated_at = ${now}
      WHERE user_id = ${userId}
    `
  } catch (error) {
    console.error('updateLastSync error:', error)
    throw error
  }
}

// Update auto sync interval
export async function updateAutoSyncInterval(
  userId: string,
  intervalMinutes: number | null
): Promise<void> {
  const now = Date.now()

  try {
    if (!HAS_DB) {
      const u = memoryDb.get(userId)
      if (u) {
        ensureDailyReset(u)
        u.auto_sync_interval_minutes = intervalMinutes
        u.updated_at = now
        memoryDb.set(userId, u)
      }
      return
    }
    await sql`
      UPDATE microos_users 
      SET auto_sync_interval_minutes = ${intervalMinutes},
          updated_at = ${now}
      WHERE user_id = ${userId}
    `
  } catch (error) {
    console.error('updateAutoSyncInterval error:', error)
    throw error
  }
}

// No longer needed - database trigger handles reset automatically
// Keeping for backward compatibility
export async function resetAllUsersDailyTimer(): Promise<number> {
  console.log('Daily reset is handled by database trigger')
  return 0
}
