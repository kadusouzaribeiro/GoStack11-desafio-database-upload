import { getRepository } from 'typeorm';
import csvParse from 'csv-parse';
import path from 'path';
import fs from 'fs';
import Transaction from '../models/Transaction';
import Category from '../models/Category';

import uploadConfig from '../config/upload';
import AppError from '../errors/AppError';

interface TransactionCSV {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(file: string): Promise<Transaction[]> {
    try {
      const parse = csvParse({ delimiter: ', ', from_line: 2 });

      const filePath = path.join(uploadConfig.directory, file);
      const readStream = fs.createReadStream(filePath);

      const parseCSV = readStream.pipe(parse);

      const transactionsCSV: TransactionCSV[] = [];

      parseCSV.on('data', async row => {
        const [title, type, value, category] = row;
        transactionsCSV.push({ title, type, value, category });
      });

      await new Promise(resolve => parseCSV.on('end', resolve));

      const transactionsRepository = getRepository(Transaction);
      const categoryRepository = getRepository(Category);

      const categories = transactionsCSV
        .map(transaction => transaction.category)
        .filter((value, index, self) => {
          return self.indexOf(value) === index;
        });

      // Verificar se já não existem as categorias a serem incluídas
      const allCategories = await categoryRepository.find();

      allCategories.forEach(({ title }) => {
        const i = categories.findIndex(c => c === title);
        if (i !== -1) {
          categories.splice(i, 1);
        }
      });

      const categoriesFinal = categories.map(category =>
        categoryRepository.create({ title: category }),
      );

      await categoryRepository.save(categoriesFinal);

      categoriesFinal.map(c => allCategories.push(c));

      const transactions = transactionsCSV.map(
        ({ title, type, value, category }) => {
          const cat = allCategories.find(c => c.title === category);

          return transactionsRepository.create({
            title,
            type,
            value,
            category_id: cat?.id,
          });
        },
      );

      await transactionsRepository.save(transactions);

      await fs.promises.unlink(filePath);

      return transactions;
    } catch {
      throw new AppError('Error when importing the transaction file');
    }
  }
}

export default ImportTransactionsService;
