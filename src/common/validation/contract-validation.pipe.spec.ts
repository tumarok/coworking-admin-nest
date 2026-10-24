import { pageQuerySchema, locationInputSchema } from '../../contract/index.js';
import { ApiError } from '../errors/api-error.js';
import { ContractValidationPipe } from './contract-validation.pipe.js';

const pipe = new ContractValidationPipe();

describe('ContractValidationPipe', () => {
  it('drops empty query values before parsing', async () => {
    const query = await pipe.transform(
      { page: '', limit: '5', q: '' },
      { type: 'query', schema: pageQuerySchema },
    );

    expect(query).toEqual({ page: 1, limit: 5 });
  });

  it('keeps empty strings in a body', async () => {
    const result = pipe.transform({ name: '' }, { type: 'body', schema: locationInputSchema });

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({
      response: { fieldErrors: { name: 'At least 2 characters' } },
    });
  });

  it('passes a value through when the parameter has no schema', async () => {
    await expect(pipe.transform('loc_1', { type: 'param', data: 'id' })).resolves.toBe('loc_1');
  });
});
