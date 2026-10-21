import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const accounts=sqliteTable('accounts',{
 id:text('id').primaryKey(),username:text('username').notNull(),usernameKey:text('username_key').notNull(),passwordHash:text('password_hash').notNull(),createdAt:text('created_at').notNull()
},t=>[uniqueIndex('accounts_username_unique').on(t.usernameKey)]);
export const accountSessions=sqliteTable('account_sessions',{
 tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull().references(()=>accounts.id,{onDelete:'cascade'}),expiresAt:integer('expires_at').notNull(),createdAt:integer('created_at').notNull()
},t=>[index('sessions_user_idx').on(t.userId),index('sessions_expiry_idx').on(t.expiresAt)]);
export const accountPredictions=sqliteTable('account_predictions',{
 userId:text('user_id').notNull().references(()=>accounts.id,{onDelete:'cascade'}),gameId:text('game_id').notNull(),month:text('month').notNull(),gameTimeUTC:text('game_time_utc').notNull(),homeTeamId:integer('home_team_id').notNull(),awayTeamId:integer('away_team_id').notNull(),pickedTeamId:integer('picked_team_id').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),resultJson:text('result_json')
},t=>[primaryKey({columns:[t.userId,t.gameId]}),index('predictions_month_idx').on(t.month,t.userId)]);
export const accountRateLimits=sqliteTable('account_rate_limits',{
 key:text('key').primaryKey(),windowStart:integer('window_start').notNull(),count:integer('count').notNull()
});
