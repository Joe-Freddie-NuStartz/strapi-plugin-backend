import { Main, Box, Textarea, TextInput, Button, Typography } from '@strapi/design-system';
import { useIntl } from 'react-intl';
import React, { useEffect, useState } from 'react';

import { getTranslation } from '../utils/getTranslation';

type Faq = {
  id: number;
  question: string;
  answer: string;
};

const HomePage = () => {
  const { formatMessage } = useIntl();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/faq-ai-bot/faqs');
        if (res.ok) {
          const data = await res.json();
          setFaqs(data || []);
        }
      } catch (err) {
      }
    })();
  }, []);

  const handleSubmit = async () => {
    if (!question || !answer) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/faq-ai-bot/faqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer }),
      });

      if (res.ok) {
        const created = await res.json();
        setFaqs((s) => [created, ...s]);
        setQuestion('');
        setAnswer('');
      } else {
        console.error('Failed to create FAQ', await res.text());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Main>
      <div style={{ padding: 16 }}>
        <Typography variant="alpha">{formatMessage({ id: getTranslation('plugin.name') })}</Typography>

        <Box padding={4} background="neutral0" shadow="table" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TextInput
              label="Question"
              name="question"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuestion(e.target.value)}
              value={question}
            />
            <Textarea
              label="Answer"
              name="answer"
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAnswer(e.target.value)}
              value={answer}
            />
            <Button onClick={handleSubmit} loading={submitting} size="L">
              Submit
            </Button>
          </div>
        </Box>

        <div style={{ marginTop: 20 }}>
          {faqs.length === 0 ? (
            <Typography>No FAQs yet</Typography>
          ) : (
            faqs.map((f) => (
              <Box key={f.id} padding={3} background="neutral100" shadow="table" style={{ marginBottom: 12 }}>
                <Typography fontWeight="bold">{f.question}</Typography>
                <Typography>{f.answer}</Typography>
              </Box>
            ))
          )}
        </div>
      </div>
    </Main>
  );
};

export { HomePage };
