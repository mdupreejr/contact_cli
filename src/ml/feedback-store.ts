import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger';

const FEEDBACK_DB_PATH = process.env.ML_FEEDBACK_DB || path.join(process.cwd(), 'data', 'ml-feedback.sqlite');

let db: Database.Database | null = null;

function ensureDir(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

export function openFeedbackDB(): Database.Database {
  if (db) return db;

  ensureDir(FEEDBACK_DB_PATH);
  db = new Database(FEEDBACK_DB_PATH);

  db.exec(`
    pragma journal_mode = wal;

    create table if not exists duplicate_feedback (
      id integer primary key autoincrement,
      contact_a_id text not null,
      contact_b_id text not null,
      user_decision text not null check(user_decision in ('approved', 'rejected')),

      -- Features used in scoring
      feature_bias real not null,
      feature_name_sim real not null,
      feature_email_eq real not null,
      feature_phone_eq real not null,
      feature_company_sim real not null,
      feature_city_eq real not null,
      feature_email_domain_eq real not null,

      -- Metadata
      model_score real not null,
      timestamp text not null default current_timestamp,

      unique(contact_a_id, contact_b_id)
    );

    create index if not exists idx_feedback_decision on duplicate_feedback(user_decision);
    create index if not exists idx_feedback_timestamp on duplicate_feedback(timestamp);
  `);

  return db!;
}

export interface FeedbackEntry {
  contactAId: string;
  contactBId: string;
  userDecision: 'approved' | 'rejected';
  features: number[];  // [bias, nameSim, emailEq, phoneEq, companySim, cityEq, emailDomainEq]
  modelScore: number;
}

export function saveFeedback(entry: FeedbackEntry): void {
  const d = openFeedbackDB();

  d.prepare(`
    insert or replace into duplicate_feedback (
      contact_a_id, contact_b_id, user_decision,
      feature_bias, feature_name_sim, feature_email_eq, feature_phone_eq,
      feature_company_sim, feature_city_eq, feature_email_domain_eq,
      model_score
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.contactAId,
    entry.contactBId,
    entry.userDecision,
    entry.features[0],
    entry.features[1],
    entry.features[2],
    entry.features[3],
    entry.features[4],
    entry.features[5],
    entry.features[6],
    entry.modelScore
  );
}

export function getAllFeedback(): Array<{
  contactAId: string;
  contactBId: string;
  userDecision: 'approved' | 'rejected';
  features: number[];
  modelScore: number;
  timestamp: string;
}> {
  const d = openFeedbackDB();

  const rows = d.prepare(`
    select
      contact_a_id, contact_b_id, user_decision,
      feature_bias, feature_name_sim, feature_email_eq, feature_phone_eq,
      feature_company_sim, feature_city_eq, feature_email_domain_eq,
      model_score, timestamp
    from duplicate_feedback
    order by timestamp desc
  `).all() as any[];

  return rows.map(r => ({
    contactAId: r.contact_a_id,
    contactBId: r.contact_b_id,
    userDecision: r.user_decision,
    features: [
      r.feature_bias,
      r.feature_name_sim,
      r.feature_email_eq,
      r.feature_phone_eq,
      r.feature_company_sim,
      r.feature_city_eq,
      r.feature_email_domain_eq
    ],
    modelScore: r.model_score,
    timestamp: r.timestamp
  }));
}

export function getFeedbackStats(): {
  total: number;
  approved: number;
  rejected: number;
  accuracyAtThreshold: { threshold: number; accuracy: number }[];
} {
  const d = openFeedbackDB();

  const stats = d.prepare(`
    select
      count(*) as total,
      sum(case when user_decision = 'approved' then 1 else 0 end) as approved,
      sum(case when user_decision = 'rejected' then 1 else 0 end) as rejected
    from duplicate_feedback
  `).get() as any;

  // Calculate accuracy at different thresholds
  const allFeedback = getAllFeedback();
  const thresholds = [0.5, 0.6, 0.7, 0.8, 0.9];
  const accuracyAtThreshold = thresholds.map(threshold => {
    const predictions = allFeedback.map(f => ({
      predicted: f.modelScore >= threshold ? 'duplicate' : 'not_duplicate',
      actual: f.userDecision === 'approved' ? 'duplicate' : 'not_duplicate'
    }));

    const correct = predictions.filter(p => p.predicted === p.actual).length;
    const accuracy = predictions.length > 0 ? correct / predictions.length : 0;

    return { threshold, accuracy };
  });

  return {
    total: stats.total || 0,
    approved: stats.approved || 0,
    rejected: stats.rejected || 0,
    accuracyAtThreshold
  };
}

export function closeFeedbackDB(): void {
  if (db) {
    try {
      db.close();
      logger.info('[feedback-store] Database connection closed');
    } catch (error) {
      logger.error('[feedback-store] Failed to close database:', error);
    } finally {
      db = null;
    }
  }
}
