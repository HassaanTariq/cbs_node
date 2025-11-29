DROP DATABASE IF EXISTS cbs_db;
CREATE DATABASE cbs_db CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE cbs_db;

CREATE TABLE UserAccount (
userid INT AUTO_INCREMENT PRIMARY KEY,
username VARCHAR(100) NOT NULL UNIQUE,
fullname VARCHAR(150) NOT NULL,
role ENUM('employee','systemoperator','admin') NOT NULL DEFAULT 'employee',
password_hash VARCHAR(255) NULL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE Customer (
customerid INT AUTO_INCREMENT PRIMARY KEY,
fullname VARCHAR(150) NOT NULL,
email VARCHAR(150) NOT NULL UNIQUE,
phone VARCHAR(30) NULL,
cnic VARCHAR(20) NULL,
address VARCHAR(255) NULL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE Branch (
branchid INT AUTO_INCREMENT PRIMARY KEY,
branchname VARCHAR(150) NOT NULL,
city VARCHAR(100) NOT NULL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE Account (
accountno INT AUTO_INCREMENT PRIMARY KEY,
customerid INT NOT NULL,
branchid INT NOT NULL,
type ENUM('saving','current') NOT NULL,
status ENUM('active','closed','suspended') NOT NULL DEFAULT 'active',
balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
opened_at DATETIME NULL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT fk_account_customer
FOREIGN KEY (customerid) REFERENCES Customer(customerid)
ON DELETE CASCADE ON UPDATE CASCADE,
CONSTRAINT fk_account_branch
FOREIGN KEY (branchid) REFERENCES Branch(branchid)
ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE TransactionLog (
transactionid INT AUTO_INCREMENT PRIMARY KEY,
accountno INT NOT NULL,
type ENUM('deposit','withdrawal','transfer') NOT NULL,
amount DECIMAL(15,2) NOT NULL,
reference_account INT NULL,
performed_by INT NULL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT fk_transaction_account
FOREIGN KEY (accountno) REFERENCES Account(accountno)
ON DELETE RESTRICT ON UPDATE CASCADE,
CONSTRAINT fk_transaction_reference_account
FOREIGN KEY (reference_account) REFERENCES Account(accountno)
ON DELETE RESTRICT ON UPDATE CASCADE,
CONSTRAINT fk_transaction_user
FOREIGN KEY (performed_by) REFERENCES UserAccount(userid)
ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE AuditLog (
logid INT AUTO_INCREMENT PRIMARY KEY,
userid INT NULL,
action VARCHAR(100) NOT NULL,
description TEXT NULL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT fk_auditlog_user
FOREIGN KEY (userid) REFERENCES UserAccount(userid)
ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Indexes
CREATE INDEX idx_useraccount_username ON UserAccount(username);
CREATE INDEX idx_customer_email ON Customer(email);
CREATE INDEX idx_account_customerid ON Account(customerid);
CREATE INDEX idx_account_branchid ON Account(branchid);
CREATE INDEX idx_account_type ON Account(type);
CREATE INDEX idx_transaction_accountno ON TransactionLog(accountno);
CREATE INDEX idx_transaction_reference_account ON TransactionLog(reference_account);
CREATE INDEX idx_transaction_performed_by ON TransactionLog(performed_by);
CREATE INDEX idx_auditlog_userid ON AuditLog(userid);

-- Seed data: UserAccount (3-4)
INSERT INTO UserAccount (username, fullname, role, password_hash) VALUES
('amer.khan','Amer Khan','admin','$2y$10$examplehash1'),
('sana.saleem','Sana Saleem','employee','$2y$10$examplehash2'),
('bilal.ops','Bilal Operations','systemoperator','$2y$10$examplehash3'),
('maryam.teller','Maryam Teller','employee','$2y$10$examplehash4');

-- Seed data: Customer (3-4)
INSERT INTO Customer (fullname, email, phone, cnic, address) VALUES
('Fatima Raza','fatima.raza@example.com','03001234567','42101-1234567-1','House 12, Gulshan-e-Iqbal, Karachi'),
('Gulzar Ali','gulzar.ali@example.com','03221234567','42101-2345678-5','Street 7, Saddar, Karachi'),
('Ahmad Khan','ahmad.khan@example.com','03004567890','42101-3456789-3','Block C, Clifton, Karachi'),
('Ayesha Noor','ayesha.noor@example.com','03111223344','42101-4567890-7','Phase 5, DHA, Karachi');

-- Seed data: Branch (2-3)
INSERT INTO Branch (branchname, city) VALUES
('Main Branch','Karachi'),
('Clifton Branch','Karachi'),
('Lahore Branch','Lahore');

-- Seed data: Account (4-6)
INSERT INTO Account (customerid, branchid, type, status, balance, opened_at) VALUES
(1, 1, 'saving', 'active', 15000.00, '2024-01-15 09:30:00'),
(2, 1, 'current', 'active', 50000.00, '2024-03-20 11:00:00'),
(3, 2, 'saving', 'active', 8200.50, '2024-07-05 14:20:00'),
(4, 2, 'saving', 'suspended', 0.00, '2025-02-01 10:00:00'),
(1, 3, 'current', 'active', 120000.00, '2025-05-10 08:45:00'),
(2, 3, 'saving', 'active', 300.75, '2025-06-02 16:10:00');

-- Seed data: TransactionLog (8-10 mixed)
-- Deposits and withdrawals
INSERT INTO TransactionLog (accountno, type, amount, reference_account, performed_by, created_at) VALUES
(1, 'deposit', 5000.00, NULL, 2, '2025-06-01 09:00:00'),
(1, 'withdrawal', 2000.00, NULL, 4, '2025-06-02 10:15:00'),
(2, 'deposit', 10000.00, NULL, 2, '2025-06-03 11:30:00'),
(3, 'withdrawal', 500.50, NULL, 4, '2025-06-04 12:00:00'),
-- Transfers
(5, 'transfer', 25000.00, 2, 3, '2025-06-05 14:45:00'),
(2, 'transfer', 25000.00, 5, 3, '2025-06-05 14:45:05'),
(6, 'deposit', 150.00, NULL, 2, '2025-06-06 09:20:00'),
(1, 'transfer', 1000.00, 6, 3, '2025-06-07 10:00:00'),
(6, 'transfer', 1000.00, 1, 3, '2025-06-07 10:00:05'),
(3, 'deposit', 2000.00, NULL, 2, '2025-06-08 15:30:00');

-- Seed data: AuditLog (4-5)
INSERT INTO AuditLog (userid, action, description, created_at) VALUES
(1, 'create_user', 'Created user sana.saleem with role employee', '2025-01-10 08:00:00'),
(2, 'login', 'User sana.saleem logged in from IP 203.0.113.5', '2025-06-01 08:58:30'),
(3, 'transfer', 'Performed inter-account transfer from account 5 to 2 amount 25000.00', '2025-06-05 14:46:00'),
(4, 'suspend_account', 'Account 4 suspended due to compliance hold', '2025-02-01 10:05:00'),
(NULL, 'system_backup', 'Automated nightly backup completed', '2025-06-01 02:00:00');