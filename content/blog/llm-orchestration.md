---
title: LLM Orchestration in Production - Lessons from Building an AI Chatbot
date: January 10, 2026
image: https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=400&fit=crop
---

When we set out to build an intelligent chatbot at Tick Boxes Management, we knew it needed to do more than just answer questions. It had to understand context, extract intents from unstructured data, and route queries intelligently. Here's what we learned building a production LLM system that reduced complaint resolution time from 48 hours to 6 hours.

## The Problem Space

Our customers were submitting complex complaints through multiple channels:
- Email
- Chat
- Voice calls (via Whisper AI transcription)
- Web forms

Each complaint needed to:
1. Be classified by intent and urgency
2. Have key information extracted
3. Be routed to the appropriate team
4. Generate an initial response

Doing this manually was slow and error-prone.

## Architecture Design

We built a multi-stage pipeline using RASA as the core framework, enhanced with BERT embeddings for better intent classification.

![Chatbot Architecture](https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&h=400&fit=crop)

### Components

**1. Intent Classification with BERT**

Instead of RASA's default featurizer, we fine-tuned BERT on our complaint dataset:

```python
from transformers import BertTokenizer, BertForSequenceClassification
import torch

class BERTIntentClassifier:
    def __init__(self, model_path):
        self.tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')
        self.model = BertForSequenceClassification.from_pretrained(model_path)
    
    def classify_intent(self, text):
        inputs = self.tokenizer(text, return_tensors='pt', 
                               truncation=True, padding=True)
        outputs = self.model(**inputs)
        predictions = torch.nn.functional.softmax(outputs.logits, dim=-1)
        return predictions
```

This improved our intent classification accuracy from 78% to 94%.

**2. Entity Extraction**

Using RASA's built-in entity extraction with custom components for domain-specific entities:
- Customer IDs
- Product references
- Dates and deadlines
- Monetary amounts

**3. Voice Integration**

Whisper AI handles voice complaints:

```python
import whisper

model = whisper.load_model("base")
result = model.transcribe(audio_file)
transcribed_text = result["text"]
```

We achieved 95%+ transcription accuracy even with varying audio quality.

## Routing Logic

The smart routing system uses a decision tree based on:
- Intent classification confidence
- Urgency level
- Required expertise
- Team availability

```python
def route_complaint(intent, urgency, entities):
    if urgency == "critical" and intent in ["service_outage", "security"]:
        return "priority_team"
    elif "refund" in entities or intent == "billing":
        return "billing_team"
    elif confidence < 0.7:
        return "human_review"
    else:
        return "general_support"
```

## Production Challenges

### Challenge 1: Response Time

Initial response times were too slow (3-5 seconds). We optimized by:
- Caching BERT model in memory
- Using batch processing for multiple requests
- Implementing async request handling

Result: Response time reduced to <500ms

### Challenge 2: Context Management

Complaints often span multiple messages. We implemented conversation memory:

```python
class ConversationMemory:
    def __init__(self):
        self.contexts = {}
    
    def update_context(self, conversation_id, message, intent, entities):
        if conversation_id not in self.contexts:
            self.contexts[conversation_id] = []
        
        self.contexts[conversation_id].append({
            'message': message,
            'intent': intent,
            'entities': entities,
            'timestamp': datetime.now()
        })
```

### Challenge 3: Handling Edge Cases

We found that 15% of complaints didn't fit standard patterns. Solution:
- Confidence thresholds for automatic routing
- Human-in-the-loop for low-confidence cases
- Continuous learning from human corrections

![Performance Metrics](https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=400&fit=crop)

## Results

After 6 months in production:

- **Resolution Time**: 48 hours → 6 hours (87.5% reduction)
- **Human Intervention**: Reduced by 70%
- **Customer Satisfaction**: Increased by 34%
- **Accuracy**: 94% intent classification, 89% entity extraction

## Team Collaboration

Leading a 4-member team on this project taught me:

1. **Clear Communication**: Daily standups kept everyone aligned
2. **Agile Methodology**: 2-week sprints with clear deliverables
3. **Code Reviews**: Caught bugs early and shared knowledge
4. **Documentation**: Essential for onboarding and maintenance

We delivered 90% of planned features on time using Scrum.

## Lessons Learned

### Technical Lessons

1. **Start Simple**: We initially over-engineered. A simpler system performed better.
2. **Monitor Everything**: Logging and metrics are crucial for debugging production issues.
3. **Test with Real Data**: Synthetic data doesn't capture real-world complexity.

### Process Lessons

1. **User Feedback**: Regular feedback sessions improved the system significantly.
2. **Iterative Development**: Small, frequent releases beat big bang deployments.
3. **Team Autonomy**: Empowering team members led to better solutions.

## Future Improvements

We're planning to:
- Add multilingual support
- Implement sentiment analysis for urgency detection
- Create a feedback loop for continuous model improvement
- Build a dashboard for real-time monitoring

## Conclusion

Building a production LLM system requires more than just good models. You need robust infrastructure, careful monitoring, and a team that can iterate quickly based on real-world feedback.

The journey from 48-hour resolution times to 6 hours wasn't just about technology—it was about understanding the problem, building the right solution, and continuously improving based on data.

Want to discuss LLM orchestration in production? I'm always happy to chat about lessons learned and best practices!
