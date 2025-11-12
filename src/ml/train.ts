import { getAllFeedback, getFeedbackStats } from './feedback-store';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Simple gradient descent for logistic regression
function trainLogisticRegression(
  X: number[][],  // Features (each row is [bias, nameSim, emailEq, phoneEq, companySim, cityEq, emailDomainEq])
  y: number[],    // Labels (1 = duplicate, 0 = not duplicate)
  learningRate: number = 0.01,
  epochs: number = 1000
): number[] {
  const n = X.length;
  const d = X[0].length;
  let weights = new Array(d).fill(0);  // Initialize weights to 0

  for (let epoch = 0; epoch < epochs; epoch++) {
    let totalLoss = 0;
    const gradient = new Array(d).fill(0);

    // Calculate gradient
    for (let i = 0; i < n; i++) {
      const z = X[i].reduce((sum, xi, j) => sum + xi * weights[j], 0);
      const prediction = 1 / (1 + Math.exp(-z));
      const error = prediction - y[i];
      totalLoss += -y[i] * Math.log(prediction + 1e-10) - (1 - y[i]) * Math.log(1 - prediction + 1e-10);

      for (let j = 0; j < d; j++) {
        gradient[j] += error * X[i][j];
      }
    }

    // Update weights
    for (let j = 0; j < d; j++) {
      weights[j] -= learningRate * gradient[j] / n;
    }

    // Log progress every 100 epochs
    if (epoch % 100 === 0) {
      console.log(`Epoch ${epoch}: Loss = ${(totalLoss / n).toFixed(4)}`);
    }
  }

  return weights;
}

// Calculate accuracy on training data
function calculateAccuracy(X: number[][], y: number[], weights: number[]): number {
  let correct = 0;
  for (let i = 0; i < X.length; i++) {
    const z = X[i].reduce((sum, xi, j) => sum + xi * weights[j], 0);
    const prediction = 1 / (1 + Math.exp(-z));
    const predicted = prediction >= 0.5 ? 1 : 0;
    if (predicted === y[i]) correct++;
  }
  return correct / X.length;
}

export async function trainModel(): Promise<{
  success: boolean;
  newWeights?: number[];
  oldWeights?: number[];
  accuracy?: number;
  sampleCount?: number;
  error?: string;
}> {
  try {
    console.log('\n🧠 Training ML Model from User Feedback\n');
    console.log('='.repeat(60));

    // Get feedback statistics
    const stats = getFeedbackStats();
    console.log(`\n📊 Feedback Statistics:`);
    console.log(`   Total decisions: ${stats.total}`);
    console.log(`   Approved: ${stats.approved} (${((stats.approved / stats.total) * 100).toFixed(1)}%)`);
    console.log(`   Rejected: ${stats.rejected} (${((stats.rejected / stats.total) * 100).toFixed(1)}%)`);

    if (stats.total < 10) {
      console.log(`\n⚠️  Warning: Only ${stats.total} feedback samples. Need at least 10 for training.`);
      console.log(`   Continue using the tool to collect more feedback.`);
      return {
        success: false,
        error: `Insufficient training data: ${stats.total} samples (minimum 10 required)`
      };
    }

    // Load feedback
    const feedback = getAllFeedback();

    // Prepare training data
    const X: number[][] = [];
    const y: number[] = [];

    for (const f of feedback) {
      X.push(f.features);
      y.push(f.userDecision === 'approved' ? 1 : 0);
    }

    // Load current weights
    const dedupeModulePath = path.join(__dirname, 'dedupe.ts');
    let currentWeightsStr = '';
    try {
      const content = fs.readFileSync(dedupeModulePath, 'utf-8');
      const match = content.match(/const W = Float32Array\.from\(\[([\s\S]*?)\]\)/);
      if (match) {
        currentWeightsStr = match[1];
      }
    } catch (error) {
      console.error('Failed to read current weights:', error);
    }

    const oldWeights = currentWeightsStr
      .split(',')
      .map(s => parseFloat(s.replace(/\/\/.*/, '').trim()))
      .filter(x => !isNaN(x));

    console.log(`\n🔧 Current Model Weights:`);
    oldWeights.forEach((w, i) => {
      const labels = ['bias', 'nameSim', 'emailEq', 'phoneEq', 'companySim', 'cityEq', 'emailDomainEq'];
      console.log(`   ${labels[i]}: ${w.toFixed(4)}`);
    });

    // Train new model
    console.log(`\n🎓 Training with ${X.length} samples...\n`);
    const newWeights = trainLogisticRegression(X, y, 0.1, 500);

    console.log(`\n✅ Training Complete!`);
    console.log(`\n🔧 New Model Weights:`);
    newWeights.forEach((w, i) => {
      const labels = ['bias', 'nameSim', 'emailEq', 'phoneEq', 'companySim', 'cityEq', 'emailDomainEq'];
      const change = ((w - oldWeights[i]) / (Math.abs(oldWeights[i]) + 1e-10) * 100).toFixed(1);
      console.log(`   ${labels[i]}: ${w.toFixed(4)} (${change > '0' ? '+' : ''}${change}% change)`);
    });

    // Calculate accuracy
    const accuracy = calculateAccuracy(X, y, newWeights);
    console.log(`\n📈 Training Accuracy: ${(accuracy * 100).toFixed(1)}%`);

    // Show accuracy at different thresholds
    console.log(`\n📊 Model Accuracy by Threshold:`);
    stats.accuracyAtThreshold.forEach(({ threshold, accuracy }) => {
      console.log(`   ${(threshold * 100).toFixed(0)}% threshold: ${(accuracy * 100).toFixed(1)}% accurate`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('\n💾 To apply these weights, update src/ml/dedupe.ts:');
    console.log('   Replace the W array with:');
    console.log('   const W = Float32Array.from([');
    newWeights.forEach((w, i) => {
      const labels = ['bias', 'nameSim', 'emailEq', 'phoneEq', 'companySim', 'cityEq', 'emailDomainEq'];
      console.log(`     ${w.toFixed(4)},  // ${labels[i]}`);
    });
    console.log('   ]);');
    console.log('');

    return {
      success: true,
      newWeights,
      oldWeights,
      accuracy,
      sampleCount: X.length
    };

  } catch (error) {
    console.error('\n❌ Training failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
