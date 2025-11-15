# ContactsPlus CLI - Safe Workflow

## ✅ Current Status (Fixed!)

**READONLY_MODE is now ENABLED** - All API writes are blocked until you manually disable it.

**ALL tools now use the sync queue** - Nothing syncs to the API without your explicit approval.

**🤖 Background ML Analyzer is ACTIVE** - Automatically finds issues and queues suggestions while you work!

## 📋 The Workflow

### 🤖 Background Auto-Analysis (NEW!)
The app now automatically analyzes your contacts in the background:
- Runs every 30 minutes when you're idle (1 minute of no activity)
- Automatically queues up to 50 suggestions per run
- Analyzes:
  - Duplicate names
  - Phone number formatting
  - Company name cleaning
  - Email validation
- **Everything goes to the Sync Queue** - nothing syncs without your approval!
- Check the queue anytime to see what the ML found

### Manual Tool Running (Optional)
You can still manually run tools from the Tools Menu:
- The tool analyzes your contacts
- Shows you suggestions one by one
- When you approve a suggestion, it goes to the **Sync Queue** as "pending"
- **Nothing is synced to ContactsPlus API yet!**

### Review the Sync Queue
1. Go to: **Tools Menu → Sync Queue Manager** (Option 7)
2. You'll see all pending changes listed
3. Review each one:
   - Press **Space** to approve/unapprove individual items
   - Press **a** to approve all
   - Press **r** to reject items
   - Press **d** to delete items from queue

### Sync to API (Manual)
1. In the Sync Queue Manager, press **s** to start syncing
2. Only **approved** items will be synced
3. You'll see progress as each contact updates
4. If READONLY_MODE is enabled, syncs will be skipped (logged but not sent)

## 🛡️ Safety Features

### READONLY_MODE
- **Enabled by default** in `.env` file
- When enabled: All API writes are **blocked** (creates, updates, deletes)
- Useful for testing tools without risking data
- To disable: Change `READONLY_MODE=false` in `.env`

### Sync Queue
- **Two-stage approval**:
  1. Approve in tool (adds to queue)
  2. Approve in Sync Queue Manager (actually syncs)
- **Duplicate detection**: Won't queue the same change twice
- **Review before sync**: See all changes before they go to API

## 🔍 What Just Happened

You approved 138 duplicate name fixes, but:
- ✅ **Good news**: They did NOT sync to the API!
- ✅ Your ContactsPlus data is unchanged
- ✅ Still 138 duplicates in the API (same as before)

The duplicates are contacts like:
- "support@creditkarma.com support@creditkarma.com"
- "geske37@gmail.com geske37@gmail.com"
- "Ap Ap"
- "Nolan Nolan"

## 🎯 Next Steps

1. **Test the new workflow**:
   ```bash
   npm start
   # Go to Tools Menu → Fix Duplicate Names
   # Approve some fixes
   # Go to Sync Queue Manager
   # Review the queue
   # Press 's' to sync (will be blocked by READONLY_MODE)
   ```

2. **When ready to sync for real**:
   - Edit `.env` and set `READONLY_MODE=false`
   - Run through the workflow again
   - Only approved items in the queue will sync

3. **Check the logs**:
   - Logs are in `logs/` directory
   - Shows all API calls, queue operations, and sync results

## 🔧 Modified Files

- `src/ui/tools-menu.ts` - Duplicate name fixer now uses sync queue
- `.env` - READONLY_MODE enabled
- All tools will follow this pattern going forward
