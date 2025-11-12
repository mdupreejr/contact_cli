import { trainModel } from './train';

trainModel().then(result => {
  if (!result.success) {
    console.error('Training failed:', result.error);
    process.exit(1);
  }
  console.log('✅ Training complete!');
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
