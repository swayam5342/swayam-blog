---
title: "What NumPy Teaches You That PyTorch Hides"
description: "Building a transformer chatbot's forward and backward passes by hand, with no autograd to lean on."
date: 2025-08-14
tags: ["python", "ml", "learning"]
---

You can use a transformer for a long time without ever writing a backward pass. PyTorch's autograd makes that invisible, which is exactly why it's worth turning off once.

Building a small transformer chatbot in pure NumPy meant deriving and implementing every gradient by hand: attention, layer norm, the feedforward block, embeddings. No `.backward()`. Just the chain rule, applied carefully, layer by layer, with a lot of shape-checking along the way.

## Attention is where it gets real

Forward pass attention is approachable — softmax over scaled dot products, weighted sum of values. The backward pass is where you actually understand *why* attention is shaped the way it is. Backpropagating through softmax requires the Jacobian of softmax itself, which isn't diagonal, which means a naive implementation either gets the math wrong or gets correct math that's needlessly slow.

Getting this right by hand made something click that reading papers hadn't: the reason attention is often described as differentiable, content-based addressing isn't just a metaphor. Watching the gradient flow back through the attention weights, scaled by how much each value contributed to the output, makes the addressing analogy literal.

## Where frameworks earn their keep

This exercise also made me appreciate exactly what autograd buys you. It's not just convenience — it's correctness. Hand-deriving twelve gradients means twelve chances to get a transpose backwards or drop a scaling factor. I found at least three such bugs the slow way: train loss refusing to decrease, then staring at shapes until something didn't add up.

None of that makes me want to ditch PyTorch for real projects. But it changed how I read other people's model code — I notice the backward pass implications of forward pass choices now, even when the framework hides them.

## Worth doing once

I wouldn't recommend building everything from scratch as a habit. But doing it once, deliberately, on something small enough to fully understand, is the kind of exercise that pays off every time you debug a model that won't converge and need to reason about where, mechanically, the gradient might be going wrong.
