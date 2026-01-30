import React, { useState } from 'react';
import { Main } from '@strapi/design-system';
import { Box } from '@strapi/design-system/Box';
import { Stack } from '@strapi/design-system/Stack';
import { TextInput } from '@strapi/design-system/TextInput';
import { Textarea } from '@strapi/design-system/Textarea';
import { Button } from '@strapi/design-system/Button';
import { useNotification } from '@strapi/helper-plugin';
import { useIntl } from 'react-intl';

import { getTranslation } from '../utils/getTranslation';

const HomePage = () => {
  const { formatMessage } = useIntl();
  const toggleNotification = useNotification();

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const resp = await fetch('/admin/plugins/faq-ai-bot/faqs', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question, answer }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || 'Failed to create FAQ');
      }

      setQuestion('');
      setAnswer('');
      toggleNotification({ type: 'success', message: { id: 'faq-ai-bot.notification.created', defaultMessage: 'FAQ created' } });
    } catch (err: any) {
      toggleNotification({ type: 'warning', message: err.message || 'Error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Main>
      <Box padding={6} background="neutral0">
        <h1>{formatMessage({ id: getTranslation('plugin.name') })}</h1>
        <form onSubmit={handleSubmit}>
          <Stack size={4}>
            <TextInput name="question" label="Question" placeholder="Enter question" value={question} onChange={(e) => setQuestion(e.target.value)} required />
            <Textarea name="answer" label="Answer" placeholder="Enter answer" value={answer} onChange={(e) => setAnswer(e.target.value)} required />
            <Button loading={loading} type="submit">Create FAQ</Button>
          </Stack>
        </form>
      </Box>
    </Main>
  );
};

export { HomePage };
